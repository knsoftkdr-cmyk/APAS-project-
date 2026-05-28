/**
 * Hardcoded subject lists per class for the Gamification setup screen.
 * These mirror the actual curriculum subjects available for each class.
 */
export const CLASS_SUBJECTS: Record<string, string[]> = {
  nursery: ['Maths', 'Science', 'English', 'Social Science', 'Hindi', 'General Knowledge'],
  lkg: ['Maths', 'Science', 'English', 'Social Science', 'Hindi', 'General Knowledge'],
  ukg: ['Maths', 'Science', 'English', 'Social Science', 'Hindi', 'General Knowledge'],
  '1': ['English', 'Hindi', 'Maths', 'Urdu'],
  '2': ['Arts', 'English', 'Hindi', 'Maths Part 1', 'Maths Part 2', 'Physical Education And Well Being', 'Sanskrit', 'Science', 'Social', 'Urdu', 'Vocational Education'],
  '3': ['Arts', 'English', 'Maths', 'Physical Education And Well Being', 'Urdu', 'World Around Us'],
  '4': ['Arts', 'English', 'Hindi', 'Maths', 'Our Wonders Of World', 'Physical Education And Well Being', 'Urdu'],
  '5': ['Arts', 'English', 'Hindi', 'Maths', 'Physical Education And Well Being', 'Urdu', 'Wonders Of World'],
  '6': ['Arts', 'English', 'Hindi', 'Physical Education And Well Being', 'Sanskrit', 'Science', 'Social', 'Urdu', 'Vocational Education'],
  '7': ['Arts', 'English', 'Hindi', 'Maths Part 1', 'Maths Part 2', 'Physical Education And Well Being', 'Sanskrit', 'Science', 'Social Part 1', 'Social Part 2', 'Urdu', 'Vocational Education'],
  '8': ['Arts', 'English', 'Hindi', 'Maths Part 1', 'Maths Part 2', 'Physical Education And Well Being', 'Sanskrit', 'Science', 'Social', 'Urdu', 'Vocational Education'],
  '9': ['Computer And Information Technology', 'Economics', 'English', 'Health And Physical Education', 'Hindi', 'Maths', 'Sanskrit', 'Science', 'Social Contemporary India', 'Social Democratic Politics', 'Urdu'],
  '10': ['Economics', 'English', 'Health And Physical Education', 'Hindi', 'Maths', 'Sanskrit', 'Science', 'Social Contemporary India', 'Social Contemporary India 2', 'Urdu'],
};

export function getSubjectsForClass(studentClass: string): string[] {
  const cls = studentClass.toLowerCase().trim();
  return CLASS_SUBJECTS[cls] || ['Maths', 'Science', 'English', 'Social Science', 'Hindi', 'General Knowledge'];
}
