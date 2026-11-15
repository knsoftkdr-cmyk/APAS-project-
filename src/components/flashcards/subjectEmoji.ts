export function subjectEmoji(label: string): string {
  const s = label.toLowerCase();
  if (/math|arith|algebra|geometry/.test(s)) return "🔢";
  if (/scien|physic|chem|bio|evs/.test(s)) return "🔬";
  if (/english|literat|grammar/.test(s)) return "📖";
  if (/hindi|telugu|tamil|urdu|sanskrit|language|kannada|malayalam/.test(s)) return "🗣️";
  if (/social|histor|geograph|civic|econom/.test(s)) return "🌍";
  if (/comput|\bit\b|coding/.test(s)) return "💻";
  if (/art|draw|music/.test(s)) return "🎨";
  return "📚";
}
