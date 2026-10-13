/**
 * Cleans AI/markdown text before it is sent to text-to-speech so symbols like
 * "*", "#", "_", "`" are never read aloud ("asterisk", "star", etc).
 * Use this in EVERY voice agent right before calling speechSynthesis / TextToSpeech.
 */
export function cleanForSpeech(input: string): string {
  if (!input) return "";
  let t = input;

  // Fenced code blocks and inline code -> keep the content, drop the fences
  t = t.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1");
  t = t.replace(/`([^`]*)`/g, "$1");

  // Markdown links / images: [label](url) -> label
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Raw URLs are unpleasant to hear
  t = t.replace(/https?:\/\/\S+/g, "");

  // Headings, blockquotes, horizontal rules
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s*([-*_]\s*){3,}$/gm, "");

  // List bullets ("* item", "- item", "• item") and numbered markers stay as natural pauses
  t = t.replace(/^\s*[*\-•+]\s+/gm, "");
  // Inline bullets that arrive on one line, e.g. "pending: * Science * Maths"
  t = t.replace(/\s\*\s+(?=\S)/g, ". ");

  // Bold / italic / strikethrough markers
  t = t.replace(/(\*\*|__|~~)(.+?)\1/g, "$2");
  t = t.replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2");

  // Any leftover stray symbols
  t = t.replace(/[*#_`~|^<>\\]/g, " ");

  // Emojis / pictographs
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "");

  // Tidy whitespace; make line breaks into pauses
  t = t.replace(/\s*\n+\s*/g, ". ").replace(/([.:;!?])\s*\.+/g, "$1").replace(/\s{2,}/g, " ");
  return t.trim();
}
