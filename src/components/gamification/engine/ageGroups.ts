export type AgeGroupId = 'early_learners' | 'explorers' | 'thinkers' | 'advanced';

export interface AgeGroup {
  id: AgeGroupId;
  label: string;
  ageRange: [number, number];
  classRange: string[];
  emoji: string;
  color: string;
  description: string;
  uiStyle: {
    buttonSize: 'xl' | 'lg' | 'md' | 'sm';
    animationSpeed: 'slow' | 'normal' | 'fast';
    colorPalette: 'bright' | 'vibrant' | 'cool' | 'dark';
    negativeScoringAllowed: boolean;
    timePressure: 'none' | 'low' | 'medium' | 'high';
  };
}

export const AGE_GROUPS: AgeGroup[] = [
  {
    id: 'early_learners',
    label: 'Early Learners',
    ageRange: [4, 7],
    classRange: ['nursery', 'lkg', 'ukg', '1', '2'],
    emoji: '🌈',
    color: '#FF6B6B',
    description: 'Fun, visuals, memory, basic recognition',
    uiStyle: {
      buttonSize: 'xl',
      animationSpeed: 'slow',
      colorPalette: 'bright',
      negativeScoringAllowed: false,
      timePressure: 'none',
    },
  },
  {
    id: 'explorers',
    label: 'Explorers',
    ageRange: [8, 11],
    classRange: ['3', '4', '5', '6'],
    emoji: '🔍',
    color: '#4ECDC4',
    description: 'Logic + basic reasoning',
    uiStyle: {
      buttonSize: 'lg',
      animationSpeed: 'normal',
      colorPalette: 'vibrant',
      negativeScoringAllowed: false,
      timePressure: 'low',
    },
  },
  {
    id: 'thinkers',
    label: 'Thinkers',
    ageRange: [12, 15],
    classRange: ['7', '8', '9', '10'],
    emoji: '🧠',
    color: '#6366F1',
    description: 'Analytical thinking + problem solving',
    uiStyle: {
      buttonSize: 'md',
      animationSpeed: 'normal',
      colorPalette: 'cool',
      negativeScoringAllowed: true,
      timePressure: 'medium',
    },
  },
  {
    id: 'advanced',
    label: 'Advanced Learners',
    ageRange: [16, 18],
    classRange: ['11', '12'],
    emoji: '🚀',
    color: '#A855F7',
    description: 'Strategy, reasoning, real-world application',
    uiStyle: {
      buttonSize: 'sm',
      animationSpeed: 'fast',
      colorPalette: 'dark',
      negativeScoringAllowed: true,
      timePressure: 'high',
    },
  },
];

export function getAgeGroupByClass(studentClass: string): AgeGroup {
  const cls = studentClass.toLowerCase().trim();
  return AGE_GROUPS.find(g => g.classRange.includes(cls)) || AGE_GROUPS[1];
}

export function getAgeGroupByAge(age: number): AgeGroup {
  return AGE_GROUPS.find(g => age >= g.ageRange[0] && age <= g.ageRange[1]) || AGE_GROUPS[1];
}

export function getAgeGroupById(id: AgeGroupId): AgeGroup {
  return AGE_GROUPS.find(g => g.id === id) || AGE_GROUPS[1];
}
